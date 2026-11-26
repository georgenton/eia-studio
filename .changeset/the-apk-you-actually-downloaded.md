---
"@eia/web": patch
---

Los tres APK publicados se comprueban leyendo el archivo que descarga un participante, no la rama:
`pnpm field:verify-apk` lee paquete, código de versión, esquema de enlace, ambiente declarado,
certificado de firma y revisa que el paquete no lleve dentro ninguna credencial. La página de
descarga trae los enlaces, los QR y las huellas de la versión final, y dice del ensayo de
actualización lo que el ensayo mostró y lo que no.
