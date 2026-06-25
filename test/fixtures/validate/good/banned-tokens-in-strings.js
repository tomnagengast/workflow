export const meta = {
  name: "banned-tokens-in-strings",
  description: "Mentions Date.now and Math.random only inside strings/comments.",
  phases: [{ title: "Run" }],
};

// A real AST walk must not flag Date.now() or Math.random() that appear only as
// text. This was the whole point of the monolith's string-scrubbing regex; the
// AST validator gets it for free because string/comment contents are not calls.
const note = "remember: Date.now() and Math.random() are banned";
const template = `also banned: new Date()`;
agent(note + template);
