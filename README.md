# ChinBotones v3.1 separado en Master/Operator (Node + WebSockets)

Este repo ahora incluye `chinbo-server/` con:

- `server.js`: servidor Express + Socket.IO.
- `data/db.json`: persistencia de oficinas/config/pcs/tokens.
- `public/master.html`: panel central remoto.
- `public/operator.html`: cliente por PC/operador.
- `public/shared.js`: helpers/renderer compartidos (employee view, flip, revin, copy, toast, escape).
- `public/shared.css`: estilos compartidos.

## 1) Instalar y correr

```bash
cd chinbo-server
npm install
npm start
```

Servidor por defecto: `http://localhost:3000`.

## 2) URLs

- Master:
  - `http://localhost:3000/master?token=master-dev-token`
- Operator:
  - `http://localhost:3000/operator/Oficina%20Central/pc_001?token=operator-dev-token`

## 3) Modelo de datos persistido

`data/db.json` usa:

```json
{
  "offices": {
    "Oficina Central": {
      "config": { "settings": {"masterPassword": ""}, "groups": [] },
      "pcs": {
        "pc_001": { "name": "PC 1", "lastSeen": 0, "online": false }
      },
      "tokens": { "masterToken": "...", "opToken": "..." }
    }
  }
}
```

## 4) Crear oficina y links por PC

1. Abrí master con token admin.
2. En **Nueva oficina** escribí nombre y clic en **Crear oficina**.
3. Editá el JSON config y guardá con **Guardar Config**.
4. En bloque **PCs**, usá **Abrir link operador** para abrir/copiar el URL.

## 5) Sincronización en tiempo real

- El operador hace `operator:hello` y queda registrado con `office + pcId`.
- Master guarda cambios con `master:updateConfig`.
- Server persiste en disco y emite `operator:config` a operadores online de esa oficina.
- `operator:ping` actualiza `lastSeen`.

## 6) Seguridad mínima

- Token de master y operador global + por oficina.
- Validación server-side de eventos socket.
- `masterPassword` puede vivir en `config.settings` pero no es requisito de autenticación en cliente.

## 7) Exponer remoto (guía)

- Correr detrás de un reverse proxy (Nginx/Caddy) con HTTPS.
- Publicar `3000` internamente y terminar TLS en proxy.
- Agregar firewall/IP allowlist si aplica.
- Rotar tokens (`masterToken`, `opToken`) en `db.json`.

