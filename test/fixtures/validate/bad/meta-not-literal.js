// meta is exported but its initializer is a call, not an object literal -> rejected
// (the loader requires an ObjectExpression so meta can be evaluated in an empty vm).
export const meta = buildMeta({ name: "meta-not-literal" });
agent("noop");
