import type { PackQuestion, WireAnswer } from "@eia/field-sync-contract";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";

import { validateSubmission, type FieldIssue } from "../core/answers";
import { surveyDraftCommand, surveySubmitCommand } from "../core/commands";
import { fieldConfig } from "../config";
import { bumpDeviceRevision, enqueue, readAnswers, saveAnswer, setSurveyState } from "../db/repo";
import { isLocallyEditable } from "../core/survey-state";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Label, Notice, Screen, Title } from "../ui";

/**
 * The questionnaire, rendered from the downloaded version and validated with the server's rules.
 *
 * ## Two buttons, two different promises
 *
 * *Guardar borrador* means **this device will not lose it**: every answer is already in the
 * encrypted local database as it is typed, and the draft survives the app being killed.
 *
 * *Enviar en el dispositivo* means **the technician is finished**. It runs the domain's own
 * `assertSubmissionComplete`, freezes the answers, and queues the submit. It does *not* mean the
 * server has it, and the screen never says it does — that sentence is reserved for an
 * acknowledgement.
 */
export function SurveyScreen({
  assignmentId,
  onBack,
}: {
  assignmentId: string;
  onBack: () => void;
}) {
  const { db, pack, assignments, refresh } = useField();
  const assignment = assignments.find((row) => row.id === assignmentId);
  const [answers, setAnswers] = useState<Record<string, WireAnswer>>({});
  const [issues, setIssues] = useState<ReadonlyArray<FieldIssue>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const surveyId = assignment?.localSurveyId ?? null;
  const questions = pack?.campaign.surveyVersion.questions ?? [];
  const editable = assignment ? isLocallyEditable(assignment.surveyState) : false;

  useEffect(() => {
    if (!db || !surveyId) return;
    void readAnswers(db, surveyId).then((stored) => {
      setAnswers(stored);
      setLoaded(true);
    });
  }, [db, surveyId]);

  // Plain function rather than `useCallback`: the React Compiler memoizes it, and a manual
  // dependency list here fights it for no benefit.
  const setAnswer = async (question: PackQuestion, answer: WireAnswer) => {
    if (!db || !surveyId) return;
    setAnswers((current) => ({ ...current, [question.code]: answer }));
    // Written as it is typed. A draft that only exists in React state is a draft that a phone
    // call, a battery, or the OS reclaiming memory can take away.
    await saveAnswer(db, surveyId, question.code, answer);
  };

  if (!assignment || !pack || !surveyId) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Title>Ficha no disponible</Title>
          <Body muted>Inicia la visita desde el predio para abrir la ficha.</Body>
          <Button label="Volver" onPress={onBack} tone="secondary" />
        </ScrollView>
      </Screen>
    );
  }

  const saveDraft = async () => {
    if (!db) return;
    const revision = await bumpDeviceRevision(db, surveyId);
    await setSurveyState(db, surveyId, "DRAFT");
    await enqueue(db, {
      entityKind: "survey",
      entityLocalId: surveyId,
      command: surveyDraftCommand(
        {
          appVersion: fieldConfig().appVersion,
          deviceRevision: revision,
          occurredAt: new Date(),
          newId: () => Crypto.randomUUID(),
        },
        {
          assignmentId: assignment.id,
          visitId: assignment.openVisitId,
          surveyVersionId: pack.campaign.surveyVersion.id,
          answers,
        },
      ),
    });
    setMessage("Borrador guardado en el dispositivo.");
    await refresh();
  };

  const submitLocally = async () => {
    if (!db) return;
    const found = validateSubmission(questions, answers);
    setIssues(found);
    if (found.length > 0) {
      setMessage(null);
      return;
    }
    const revision = await bumpDeviceRevision(db, surveyId);
    await setSurveyState(db, surveyId, "READY_TO_SYNC");
    await enqueue(db, {
      entityKind: "survey",
      entityLocalId: surveyId,
      command: surveySubmitCommand(
        {
          appVersion: fieldConfig().appVersion,
          deviceRevision: revision,
          occurredAt: new Date(),
          newId: () => Crypto.randomUUID(),
        },
        {
          assignmentId: assignment.id,
          visitId: assignment.openVisitId,
          surveyVersionId: pack.campaign.surveyVersion.id,
          answers,
        },
      ),
    });
    setMessage(
      "Enviada en el dispositivo. Queda pendiente de sincronización hasta que haya señal.",
    );
    await refresh();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Label>Predio {assignment.parcelCode}</Label>
          <Title>{pack.campaign.surveyVersion.templateName}</Title>
          <Chip text={`Versión ${pack.campaign.surveyVersion.versionLabel}`} />
        </View>

        {!editable ? (
          <Notice
            text="Esta ficha ya fue enviada en el dispositivo. No se edita aquí: una corrección es una decisión de la coordinación, no un cambio silencioso en el teléfono."
            tone="warn"
          />
        ) : null}
        {message ? <Notice text={message} tone="ok" /> : null}
        {issues.length > 0 ? (
          <Notice
            text={`Faltan respuestas o hay valores no válidos: ${issues
              .map((issue) => issue.message)
              .join(" ")}`}
            tone="crit"
          />
        ) : null}

        {loaded
          ? questions.map((question) => (
              <QuestionField
                answer={answers[question.code]}
                editable={editable}
                key={question.code}
                onChange={(value) => void setAnswer(question, value)}
                question={question}
              />
            ))
          : null}

        {editable ? (
          <View style={styles.actions}>
            <Button label="Guardar borrador" onPress={() => void saveDraft()} tone="secondary" />
            <Button
              hint="Valida la ficha completa y la deja lista para sincronizar."
              label="Enviar en el dispositivo"
              onPress={() => void submitLocally()}
            />
          </View>
        ) : null}
        <Button label="Volver" onPress={onBack} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

function QuestionField({
  question,
  answer,
  editable,
  onChange,
}: {
  question: PackQuestion;
  answer: WireAnswer | undefined;
  editable: boolean;
  onChange: (answer: WireAnswer) => void;
}) {
  return (
    <Card>
      <Heading>
        {question.prompt}
        {question.required ? " *" : ""}
      </Heading>
      {question.helpText ? <Body muted>{question.helpText}</Body> : null}
      {renderControl(question, answer, editable, onChange)}
    </Card>
  );
}

function renderControl(
  question: PackQuestion,
  answer: WireAnswer | undefined,
  editable: boolean,
  onChange: (answer: WireAnswer) => void,
) {
  switch (question.type) {
    case "BOOLEAN":
      return (
        <Switch
          accessibilityLabel={question.prompt}
          disabled={!editable}
          onValueChange={(value) => onChange({ kind: "boolean", value })}
          value={answer?.kind === "boolean" ? answer.value : false}
        />
      );
    case "INTEGER":
    case "DECIMAL":
      return (
        <TextInput
          accessibilityLabel={question.prompt}
          editable={editable}
          inputMode="numeric"
          onChangeText={(text) => {
            const value = Number(text.replace(",", "."));
            onChange(
              text.trim() === "" || !Number.isFinite(value)
                ? { kind: "blank" }
                : { kind: "number", value },
            );
          }}
          style={styles.input}
          value={answer?.kind === "number" ? String(answer.value) : ""}
        />
      );
    case "SINGLE_CHOICE":
      return (
        <View style={styles.options}>
          {question.options.map((option) => {
            const selected = answer?.kind === "option" && answer.optionCode === option.code;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !editable }}
                disabled={!editable}
                key={option.code}
                onPress={() => onChange({ kind: "option", optionCode: option.code })}
                style={[styles.option, selected ? styles.optionSelected : null]}
              >
                <Body>{option.label}</Body>
              </Pressable>
            );
          })}
        </View>
      );
    case "MULTI_CHOICE": {
      const chosen = answer?.kind === "options" ? answer.optionCodes : [];
      return (
        <View style={styles.options}>
          {question.options.map((option) => {
            const selected = chosen.includes(option.code);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: !editable }}
                disabled={!editable}
                key={option.code}
                onPress={() =>
                  onChange({
                    kind: "options",
                    optionCodes: selected
                      ? chosen.filter((code) => code !== option.code)
                      : [...chosen, option.code],
                  })
                }
                style={[styles.option, selected ? styles.optionSelected : null]}
              >
                <Body>{option.label}</Body>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case "DATE":
      return (
        <TextInput
          accessibilityLabel={`${question.prompt} (AAAA-MM-DD)`}
          editable={editable}
          onChangeText={(text) =>
            onChange(text.trim() === "" ? { kind: "blank" } : { kind: "date", value: text.trim() })
          }
          placeholder="AAAA-MM-DD"
          style={styles.input}
          value={answer?.kind === "date" ? answer.value : ""}
        />
      );
    default:
      return (
        <TextInput
          accessibilityLabel={question.prompt}
          editable={editable}
          multiline={question.type === "LONG_TEXT"}
          onChangeText={(text) => onChange({ kind: "text", value: text })}
          style={[styles.input, question.type === "LONG_TEXT" ? styles.inputLong : null]}
          value={answer?.kind === "text" ? answer.value : ""}
        />
      );
  }
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
  actions: { gap: theme.space.sm, marginTop: theme.space.md },
  input: {
    minHeight: theme.touch,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    backgroundColor: theme.surface,
    paddingHorizontal: theme.space.md,
    fontSize: theme.font.body,
    color: theme.ink,
  },
  inputLong: { minHeight: theme.touch * 2, textAlignVertical: "top", paddingTop: theme.space.sm },
  options: { gap: theme.space.sm },
  option: {
    minHeight: theme.touch,
    justifyContent: "center",
    paddingHorizontal: theme.space.md,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    backgroundColor: theme.surface,
  },
  optionSelected: { borderColor: theme.accent, backgroundColor: theme.accentSoft, borderWidth: 2 },
});
