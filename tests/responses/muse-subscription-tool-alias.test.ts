import { describe, expect, test } from "bun:test";
import {
  aliasMuseSubscriptionBuiltinTools,
  mergeMuseToolNameAliases,
  MUSE_CODE_BUILTIN_TOOL_NAMES,
} from "../../src/responses/muse-subscription-tool-alias";

const fn = (name: string) => ({
  type: "function",
  name,
  description: "fixture",
  parameters: { type: "object", properties: {} },
});

describe("Muse subscription builtin alias", () => {
  test("aliases the async input tool next to the other colliding builtins", () => {
    const body = {
      tools: [fn("request_user_input"), fn("request_user_input_async"), fn("shell"), fn("exec_command")],
    };
    const result = aliasMuseSubscriptionBuiltinTools(body);
    const names = (result.body as { tools: Array<{ name: string }> }).tools.map(tool => tool.name);
    expect(names).toEqual([
      "client_request_user_input",
      "client_request_user_input_async",
      "client_shell",
      "exec_command",
    ]);
    expect(result.aliases.get("client_request_user_input_async")).toBe("request_user_input_async");
    expect(result.aliases.size).toBe(3);
  });

  test("keeps a generated wire name unique against declared names", () => {
    const result = aliasMuseSubscriptionBuiltinTools({ tools: [fn("client_shell"), fn("shell")] });
    const names = (result.body as { tools: Array<{ name: string }> }).tools.map(tool => tool.name);
    expect(names[0]).toBe("client_shell");
    expect(names[1]).toBe("client_shell_2");
    expect(new Set(names).size).toBe(names.length);
  });

  test("rewrites replayed history and a named tool_choice with the same map", () => {
    const result = aliasMuseSubscriptionBuiltinTools({
      tools: [fn("request_user_input_async")],
      tool_choice: { type: "function", name: "request_user_input_async" },
      input: [{ type: "function_call", name: "request_user_input_async", call_id: "c1", arguments: "{}" }],
    });
    const body = result.body as {
      tool_choice: { name: string };
      input: Array<{ name: string }>;
    };
    expect(body.tool_choice.name).toBe("client_request_user_input_async");
    expect(body.input[0]?.name).toBe("client_request_user_input_async");
  });

  test("leaves names outside the builtin catalog untouched", () => {
    const result = aliasMuseSubscriptionBuiltinTools({ tools: [fn("exec_command")] });
    expect((result.body as { tools: Array<{ name: string }> }).tools[0]?.name).toBe("exec_command");
    expect(result.aliases.size).toBe(0);
    expect(MUSE_CODE_BUILTIN_TOOL_NAMES.has("exec_command")).toBe(false);
    expect(MUSE_CODE_BUILTIN_TOOL_NAMES.has("request_user_input_async")).toBe(true);
  });

  test("merges both restoration maps without dropping entries", () => {
    const merged = mergeMuseToolNameAliases(
      new Map([["a", "client_a"]]),
      new Map([["b", "client_b"]]),
    );
    expect([...merged.entries()]).toEqual([["a", "client_a"], ["b", "client_b"]]);
  });
});

