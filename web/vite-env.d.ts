/// <reference types="vite/client" />
// Declares `*.css` and `import.meta.env` so `import "@mantine/core/styles.css"`
// typechecks. Vite strips types at build time and never reads this file, which
// is exactly why it is needed: without it the import is only an error to tsc.
