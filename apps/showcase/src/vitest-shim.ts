// The state checks (@yadad/testing/state-checks) spy on console.error through
// vitest's `vi`. The showcase runs them in the browser, where vitest is not
// available, so the Vite config points the "vitest" import here. Only the one
// call the checks make is supported.

type Method = (...args: unknown[]) => unknown;

export const vi = {
  spyOn(target: Record<string, Method>, name: string) {
    const original = target[name];
    return {
      mockImplementation(replacement: Method) {
        target[name] = replacement;
        return this;
      },
      mockRestore() {
        if (original) target[name] = original;
      },
    };
  },
};
