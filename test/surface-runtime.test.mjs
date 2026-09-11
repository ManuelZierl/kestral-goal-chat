import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function record(index, value, revision = 1) {
  const timestamp = new Date(index * 1000).toISOString();
  return { id: uuid(index), revision, created_at: timestamp, updated_at: timestamp, value };
}

function completedResult(reply = "A useful answer") {
  return {
    result: {
      kind: "completed",
      result: {
        message: {
          content: JSON.stringify({
            reply,
            goal_interpretation: "Ship safely",
            working_solution: "Run the release checklist.",
            open_questions: [],
            decisions: ["Use exact commits"],
            constraints: ["No mutable evidence"],
            assumptions: [],
          }),
        },
      },
    },
  };
}

function dataFixture(initial, failTransactions = new Set()) {
  let nextId = 1000;
  let transactionCount = 0;
  const transactionCalls = [];
  let collections = structuredClone(initial);

  function selected(collection) {
    const records = collections[collection];
    if (!records) throw new Error(`unknown collection ${collection}`);
    return records;
  }

  const declarations = {
    state: { queryResults: 10, operations: new Set(["get", "list", "create", "replace", "delete", "transaction"]) },
    messages: { queryResults: 100, operations: new Set(["get", "list", "create", "replace", "delete", "transaction"]) },
  };

  function requireOperation(collection, operation) {
    if (!declarations[collection]?.operations.has(operation)) throw new Error(`${collection} does not permit ${operation}`);
  }

  function mutate(target, operation) {
    const records = target[operation.collection];
    if (!records) throw new Error(`unknown collection ${operation.collection}`);
    if (operation.kind === "create") {
      const created = record(nextId++, structuredClone(operation.value));
      records.push(created);
      return structuredClone(created);
    }
    const index = records.findIndex((item) => item.id === operation.id);
    if (index < 0 || records[index].revision !== operation.expectedRevision) throw new Error("stale record revision");
    if (operation.kind === "replace") {
      records[index] = {
        ...records[index],
        revision: records[index].revision + 1,
        updated_at: new Date(nextId * 1000).toISOString(),
        value: structuredClone(operation.value),
      };
      return structuredClone(records[index]);
    }
    if (operation.kind === "delete") {
      const result = { id: operation.id, deleted: true, revision: records[index].revision + 1 };
      records.splice(index, 1);
      return result;
    }
    throw new Error(`unsupported mutation ${operation.kind}`);
  }

  const api = {
    async list(collection, query = {}) {
      requireOperation(collection, "list");
      const sorted = structuredClone(selected(collection)).sort((left, right) => left.id.localeCompare(right.id));
      const after = query.after ? sorted.filter((item) => item.id > query.after) : sorted;
      const limit = Math.min(query.limit || declarations[collection].queryResults, declarations[collection].queryResults);
      const records = after.slice(0, limit);
      return {
        records,
        ...(after.length > limit ? { next_after: records.at(-1).id } : {}),
      };
    },
    async create(collection, value) {
      requireOperation(collection, "create");
      const operation = { kind: "create", collection, value };
      return mutate(collections, operation);
    },
    async replace(collection, id, expectedRevision, value) {
      requireOperation(collection, "replace");
      return mutate(collections, { kind: "replace", collection, id, expectedRevision, value });
    },
    async delete(collection, id, expectedRevision) {
      requireOperation(collection, "delete");
      return mutate(collections, { kind: "delete", collection, id, expectedRevision });
    },
    async transaction(operations) {
      transactionCount += 1;
      transactionCalls.push(structuredClone(operations));
      if (failTransactions.has(transactionCount)) throw new Error(`transaction ${transactionCount} failed`);
      const next = structuredClone(collections);
      const results = [];
      for (const operation of operations) {
        requireOperation(operation.collection, "transaction");
        requireOperation(operation.collection, operation.kind);
        results.push(mutate(next, operation));
      }
      collections = next;
      return results;
    },
  };

  return {
    api,
    records: (collection) => structuredClone(selected(collection)),
    transactionCalls,
  };
}

async function mount({ initial = { state: [], messages: [] }, invoke = async () => completedResult(), failTransactions } = {}) {
  const data = dataFixture(initial, failTransactions);
  const reports = [];
  let initialize;
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://goal-chat.invalid/",
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false });
      window.confirm = () => true;
      window.appHost = {
        data: { v1: data.api },
        invoke,
        onInit(callback) { initialize = callback; },
        ready() {},
        reportError(message) { reports.push(message); },
      };
    },
  });
  assert.equal(typeof initialize, "function");
  await initialize();
  return { dom, data, reports };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

async function submit(dom, text) {
  const input = dom.window.document.getElementById("composer-input");
  const send = dom.window.document.getElementById("send");
  input.value = text;
  dom.window.document.getElementById("composer-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => !send.disabled, "send operation did not finish");
}

async function startNewConversation(dom) {
  const button = dom.window.document.getElementById("new-conversation");
  button.click();
  await waitFor(() => !button.disabled, "conversation clearing did not finish");
}

test("a completed turn atomically replaces state and creates its assistant message", async () => {
  const { dom, data } = await mount();
  await submit(dom, "Help me ship");

  assert.equal(data.transactionCalls.length, 1);
  assert.deepEqual(data.transactionCalls[0].map(({ kind, collection }) => ({ kind, collection })), [
    { kind: "replace", collection: "state" },
    { kind: "create", collection: "messages" },
  ]);
  assert.equal(data.records("messages").length, 2);
  assert.equal(data.records("state")[0].value.working_solution, "Run the release checklist.");
});

test("a failed completion transaction retains prior state and retry does not duplicate the user message", async () => {
  const initialState = {
    user_goal: "Ship",
    goal_interpretation: "Prior interpretation",
    working_solution: "Prior solution",
    open_questions: [],
    decisions: [],
    constraints: [],
    assumptions: [],
  };
  const { dom, data, reports } = await mount({
    initial: { state: [record(1, initialState)], messages: [] },
    failTransactions: new Set([1]),
  });

  await submit(dom, "Continue");
  assert.equal(data.records("messages").filter((item) => item.value.role === "user").length, 1);
  assert.equal(data.records("messages").filter((item) => item.value.role === "assistant").length, 0);
  assert.deepEqual(data.records("state")[0].value, initialState);
  assert.match(reports.at(-1), /retry without duplicating/);

  await submit(dom, "Continue");
  assert.equal(data.records("messages").filter((item) => item.value.role === "user").length, 1);
  assert.equal(data.records("messages").filter((item) => item.value.role === "assistant").length, 1);
  assert.equal(data.records("state")[0].value.working_solution, "Run the release checklist.");
});

test("large conversation clearing reloads partial progress and can be resumed", async () => {
  const state = record(99, {
    user_goal: "Ship",
    goal_interpretation: "Ship safely",
    working_solution: "Pending",
    open_questions: [],
    decisions: [],
    constraints: [],
    assumptions: [],
  });
  const messages = Array.from({ length: 134 }, (_, index) => record(index + 1, {
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Message ${index + 1}`,
    created_at: new Date(index * 1000).toISOString(),
  }));
  const { dom, data, reports } = await mount({
    initial: { state: [state], messages },
    failTransactions: new Set([2]),
  });

  await startNewConversation(dom);
  assert.equal(data.transactionCalls[0].length, 32);
  assert.equal(data.records("messages").length, 102);
  assert.equal(data.records("state").length, 1);
  assert.match(reports.at(-1), /Choose New conversation again to finish clearing/);

  await startNewConversation(dom);
  assert.equal(data.records("messages").length, 0);
  assert.equal(data.records("state").length, 0);
  assert.equal(dom.window.document.getElementById("empty").hidden, false);
});
