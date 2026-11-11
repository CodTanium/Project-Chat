// Chat server tests: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { io: connect } = require("socket.io-client");
const { createChatServer, MAX_MESSAGE_LENGTH } = require("../server");

let chat;
let url;
const clients = [];

before(async () => {
  chat = createChatServer();
  await new Promise((resolve) => chat.server.listen(0, resolve));
  url = `http://127.0.0.1:${chat.server.address().port}`;
});

after(async () => {
  clients.forEach((c) => c.close());
  chat.io.close();
  await new Promise((resolve) => chat.server.close(resolve));
});

// Connects, answers the name request and resolves with the client and its confirmed name.
function join(name) {
  return new Promise((resolve) => {
    const client = connect(url, { transports: ["websocket"], forceNew: true });
    clients.push(client);
    client.messages = [];
    client.on("chat_message", (m) => client.messages.push(m));
    client.on("request_name", () => client.emit("set_name", name));
    client.on("name_confirmed", ({ name: confirmed }) => resolve({ client, name: confirmed }));
  });
}

// Waits until `client` has received a message that matches `predicate`.
function waitFor(client, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const found = client.messages.find(predicate);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error("message not received")), timeoutMs);
    client.on("chat_message", function check(m) {
      if (predicate(m)) {
        clearTimeout(timer);
        client.off("chat_message", check);
        resolve(m);
      }
    });
  });
}

test("health endpoint answers", async () => {
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "ok");
});

test("a message reaches every client with the sender's name", async () => {
  const anna = await join("Anna");
  const ben = await join("Ben");
  anna.client.emit("chat_message", { message: "hello everyone" });
  const received = await waitFor(ben.client, (m) => m.message === "hello everyone");
  assert.equal(received.user, "Anna");
});

test("names are trimmed, made unique, and 'Server' cannot be used", async () => {
  const a = await join("  Sam  ");
  const b = await join("sam");
  const c = await join("Server");
  assert.equal(a.name, "Sam");
  assert.equal(b.name, "sam2");
  assert.match(c.name, /^Guest-/);
});

test("empty and bad messages are ignored, long ones are shortened", async () => {
  const { client } = await join("Tester");
  client.emit("chat_message", "   ");
  client.emit("chat_message", null);
  client.emit("chat_message", { message: 42 });
  client.emit("chat_message", "x".repeat(MAX_MESSAGE_LENGTH + 100));
  const long = await waitFor(client, (m) => m.user === "Tester");
  assert.equal(long.message.length, MAX_MESSAGE_LENGTH);
});

test("/users lists who is online, only to the asker", async () => {
  const asker = await join("Asker");
  const other = await join("Other");
  asker.client.emit("chat_message", "/users");
  const list = await waitFor(asker.client, (m) => m.message.startsWith("Online:"));
  assert.match(list.message, /Asker/);
  assert.match(list.message, /Other/);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!other.client.messages.some((m) => m.message.startsWith("Online:")));
});

test("leaving is announced", async () => {
  const stay = await join("Stay");
  const leave = await join("Leaver");
  leave.client.close();
  await waitFor(stay.client, (m) => m.message === "Leaver has left the chat.");
});
