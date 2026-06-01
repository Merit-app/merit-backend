// Module declarations for packages that lack bundled TypeScript types
// These can be removed once the packages are fully installed with their type files.

// twilio ships its own types but they are in the installed package; this declaration
// is only needed when node_modules is incomplete (e.g. disk-space-limited CI install).
declare module 'twilio';
