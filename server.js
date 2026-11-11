// Chat server: Express + Socket.IO. Clients pick a name, then every message is sent to everyone.
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const MAX_NAME_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 500;

function createChatServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN || "*" },
  });

  // socket.id -> username
  const users = {};

  app.get("/health", (req, res) => res.json({ status: "ok", online: Object.keys(users).length }));

  const serverMessage = (message) => io.emit("chat_message", { user: "Server", message });

  io.on("connection", (socket) => {
    socket.emit("request_name");

    socket.on("set_name", (rawName) => {
      if (users[socket.id]) return; // a client chooses its name once

      let name = typeof rawName === "string" ? rawName.trim().slice(0, MAX_NAME_LENGTH) : "";
      if (!name || name.toLowerCase() === "server") name = `Guest-${socket.id.slice(0, 4)}`;
      // Keep names unique, so everyone knows who is talking.
      const taken = new Set(Object.values(users).map((n) => n.toLowerCase()));
      let unique = name;
      for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = `${name}${i}`;

      users[socket.id] = unique;
      socket.emit("name_confirmed", { name: unique });
      serverMessage(`${unique} has joined the chat! (${Object.keys(users).length} online)`);
    });

    socket.on("chat_message", (data) => {
      const username = users[socket.id];
      if (!username) return; // must choose a name first

      const raw = typeof data === "string" ? data : data && typeof data.message === "string" ? data.message : "";
      const message = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!message) return;

      if (message === "/users") {
        socket.emit("chat_message", { user: "Server", message: `Online: ${Object.values(users).join(", ")}` });
        return;
      }

      io.emit("chat_message", { user: username, message });
    });

    socket.on("disconnect", () => {
      const username = users[socket.id];
      if (username) {
        delete users[socket.id];
        serverMessage(`${username} has left the chat.`);
      }
    });
  });

  return { app, server, io };
}

if (require.main === module) {
  const { server } = createChatServer();
  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, () => console.log(`Chat server running on http://localhost:${PORT}`));
}

module.exports = { createChatServer, MAX_NAME_LENGTH, MAX_MESSAGE_LENGTH };
