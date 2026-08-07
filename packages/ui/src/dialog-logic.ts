export function dialogTabDestination<T>(
  focusable: readonly T[],
  active: T | undefined,
  backwards: boolean,
): T | undefined {
  if (focusable.length === 0) return;
  const activeIndex = active === undefined ? -1 : focusable.indexOf(active);
  if (activeIndex < 0) {
    return backwards ? focusable.at(-1) : focusable[0];
  }
  if (backwards && activeIndex === 0) return focusable.at(-1);
  if (!backwards && activeIndex === focusable.length - 1) return focusable[0];
}

export function collectBackgroundSiblings<T>(
  start: T,
  parentOf: (node: T) => T | undefined,
  childrenOf: (node: T) => readonly T[],
  stopAt?: T,
): T[] {
  const background: T[] = [];
  const seen = new Set<T>();
  let branch = start;
  for (;;) {
    const parent = parentOf(branch);
    if (!parent) break;
    for (const sibling of childrenOf(parent)) {
      if (sibling === branch || seen.has(sibling)) continue;
      seen.add(sibling);
      background.push(sibling);
    }
    if (parent === stopAt) break;
    branch = parent;
  }
  return background;
}
