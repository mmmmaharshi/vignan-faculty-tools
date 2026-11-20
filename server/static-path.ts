import path from "node:path";

/**
 * Resolve a request pathname inside one build directory. Both sides are
 * normalised before the prefix check, so a sibling such as `distsecret` and a
 * path that escapes with `..` are refused before any file is opened.
 */
export function resolveWithin(root: string, pathname: string): string | null {
  const rootDir = path.resolve(root);
  const resolved = path.resolve(root, `.${pathname}`);
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep))
    return null;
  return resolved;
}
