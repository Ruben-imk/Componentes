# Agente de impresión silenciosa por computadora

Instala una copia de esta carpeta en cada computadora que deba imprimir. Cada equipo debe tener un `PRINT_AGENT_ID` único definido por el administrador en el `.env` local. **El usuario no necesita escribir ni guardar el ID en la pantalla Packing**: el navegador lo obtiene automáticamente desde el agente local.

## Configuración

1. Instala Node.js LTS y SumatraPDF en la computadora.
2. Copia esta carpeta a una ruta estable, por ejemplo `C:\PackingPrintAgent`.
3. Copia `.env.example` como `.env`.
4. Configura `PACKING_SERVER_URL` con la URL accesible del sitio APP PACKING (por ejemplo, `https://packing.empresa.local`; no uses `localhost` si el backend está en el servidor central).
5. Copia el mismo `PRINT_AGENT_TOKEN` configurado en el `.env` del servidor.
6. Define un ID único, por ejemplo `PRINT_AGENT_ID=PACKING-PC-01`, `PRINT_AGENT_ID=PACKING-PC-02`, etc. Usa solo letras, números, guion y guion bajo.
7. Deja `PRINTER_NAME` vacío para imprimir en la impresora predeterminada de Windows.
8. Ejecuta `npm install` y luego `npm start`.
9. Abre Packing desde el navegador de esa computadora. Al solicitar una impresión, la página consulta automáticamente `http://127.0.0.1:17891/identity` para conocer el ID del agente y asigna el trabajo a ese equipo.
10. Haz una prueba y confirma que el documento sale en la impresora predeterminada de esa PC.

## Cómo funciona el endpoint local

- El agente expone únicamente en `127.0.0.1:17891` un endpoint `GET /identity`.
- El endpoint devuelve el `PRINT_AGENT_ID` definido en el `.env` de esa computadora.
- Solo permite CORS para el origen configurado en `PACKING_SERVER_URL`.
- No requiere abrir el puerto 17891 en el firewall de Windows; no escucha en la interfaz de red.
- No es un endpoint de impresión ni expone la cola; solo informa la identidad local.

No reutilices un ID entre computadoras, porque los trabajos se enrutan por ese ID. La cuenta de Windows que ejecuta el agente debe tener configurada y acceso a la impresora predeterminada. Configura el agente para iniciar sesión automáticamente mediante el Programador de tareas, ejecutado bajo la cuenta que tenga acceso a la impresora.
