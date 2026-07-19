export const meta = {
  name: "banned-tokens-in-strings",
  description: "Mentions Date.now and Math.random only inside strings/comments.",
  phases: [{ title: "Run" }],
};

// The AST walk must not flag Date.now() or Math.random() in strings or comments.
const note = "remember: Date.now() and Math.random() are banned";
const template = `also banned: new Date()`;
agent(note + template);
