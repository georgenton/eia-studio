# Uploading a document, and what a version means

> Related: ADR-031 (this layer's decisions), ADR-020 (no citation nobody can check), ADR-021
> (retrieval is full-text; a document flagged as holding personal data is refused, not redacted),
> ADR-029 (the product is bilingual), `docs/OBJECT_STORAGE.md`, `docs/DATA_MODEL.md`.

## 1. The three things, and why they are three

| | Is | Changes when |
|---|---|---|
| `SourceDocument` | the document as a **name**: *Estudio social*, `DOC-002` | never, in practice; it is the identity people use |
| `DocumentVersion` | a **file**: its bytes, its hash, its extracted text, its state | a new delivery arrives → a new version |
| `DocumentChunk` | a **passage**: the unit a citation names | never; a version's chunks are written once |

A corrected delivery is **version 2 of the same document**, never a second document. A finding
raised in March cited words; those words have to still be there in June, and they are, because
nothing overwrites v1 — not its row, not its object, not its chunks.

The document points at a current version. Every citation names a version explicitly, so moving the
pointer never moves a citation.

## 2. Uploading

The surface is the Documents page, for anyone with `documents.write`. Three steps happen behind one
button (`docs/OBJECT_STORAGE.md` §3): an intent, a direct PUT to the provider, a finalize that
verifies against the provider. Then `uploadDocumentVersion` writes the version.

What the person supplies:

| Field | Required | Note |
|---|---|---|
| a new document, or a version of an existing one | yes | creating a document is a decision, never inferred from a filename |
| code, title, kind | for a new document | the code is unique per project; a code already in use is refused with a sentence that says to add a version instead |
| the file | yes | `.pdf` or `.docx` |
| personal-data classification | yes | defaults to *review required*; see §5 |
| document date | no | the date the document itself bears |
| provenance note | yes | where the file came from and who delivered it |

### The same file twice

Byte-identical content uploaded to the same document is **answered, not duplicated**: the caller is
told it is the same content and which version already holds it. A version whose only difference from
its predecessor is its number would move "which version is current" under every reader for no
observable cause.

A *different* hash is always a new version — including a file whose text is the same but whose bytes
are not, because this layer compares files and does not claim to compare meanings.

### What happens when the transfer fails

Nothing. No version exists, the intent stays unconsumed and expires, and the form is still filled
in. There is no partial state to discover later.

## 3. Uploaded is not processed

A new version lands as:

```
processing_state   UPLOADED
text_source        PENDING_EXTRACTION
page_count         0
chunk_count        0
chunking_strategy  "pending"
```

and the surface says so, in the list and again on the version page. This matters more than it
looks: a version shown as an ordinary document with zero passages reads as *this document contains
nothing*, which is a statement about the study rather than about our pipeline.

```
UPLOADED → QUEUED → PROCESSING → READY | REQUIRES_OCR | FAILED
```

`REQUIRES_OCR` is terminal and honest — a scanned PDF has no native text, and this product does not
invent what its pages say. The file stays available to download and read by hand.

The extraction worker that produces the states after `UPLOADED` is the **next PR**. Until it exists
every uploaded version stays `UPLOADED`, and the pilot's transcribed corpus — `READY`, with
`RECONSTRUCTED_EXCERPT` as its text source — is what the assistant and the Quality Gate read.

## 4. Two hashes, and why

| Column | Is | Why both |
|---|---|---|
| `file_sha256` | the SHA-256 of the delivered bytes, computed by us from the object we read back | deduplication, and the answer to *is this the same file* |
| `content_hash` | the SHA-256 of the **extracted text** | the answer to *did the words change*, which is what the existing ingest path already used |

Until extraction runs, `content_hash` holds the file hash. The alternative — the empty string's
digest — is a value every unprocessed version would share, which would make the column say they are
all the same document.

## 5. The privacy classification is a claim, not a finding

| Value | Means |
|---|---|
| `REVIEW_REQUIRED` | **the default.** Nobody has looked |
| `CONTAINS_PERSONAL_DATA` | the uploader says it does |
| `NO_PERSONAL_DATA_KNOWN` | the uploader says it does not, as far as they know |

It defaults to *review required* and never to "none known", because at upload time the product has
read nothing, and a green state nobody checked is exactly the one that would later be quoted as
though somebody had. The name of the third value says its own limit: *known*.

Only `NO_PERSONAL_DATA_KNOWN` is eligible to leave for a model provider. That is ADR-021 §4's
existing refusal — a document that holds personal data is refused, not redacted — expressed on the
new column.

## 6. Provenance

A delivered file is an imported document observed as it arrived, so the version's provenance record
is `HISTORICAL_OBSERVED` / `IMPORTED_DOCUMENT` / `ORIGINAL` / `AGGREGATE`, with the uploader's note
as its note and `validation_state = PENDING`.

That is deliberately the opposite of the pilot's transcribed excerpts, whose transformation facet
says `RECONSTRUCTED` precisely because nobody uploaded them. `method` is left null: nothing has been
extracted, and naming a segmentation strategy would describe work that has not happened.

## 7. Audit

| Action | Records | Never records |
|---|---|---|
| `storage.upload.intent_issued` | namespace, size | the filename — an audit line is read by more people than the row is, and a filename can name a person |
| `storage.upload.finalized` | namespace, size, whether the content was already present | the hash, the key, the filename |
| `document.version.uploaded` | document code, version label, privacy classification, size | the filename, the text |

## 8. What is not here

- **Extraction, page locators, OCR detection** — the next PR.
- **Deleting a version.** There is no way to, and that is the point of the table.
- **Approving a version.** There is no approval workflow anywhere in this product (TD-060), and a
  state that looked like one would be the same misreading the report's *BORRADOR* banner prevents.
- **A viewer.** A version is downloaded through a short-lived presigned link; rendering a PDF in the
  product is a separate piece of work.
