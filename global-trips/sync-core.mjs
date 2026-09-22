export const groups = ['checks', 'packingStates', 'notes', 'budgets'];
export const emptyState = () => Object.fromEntries(groups.map(group => [group, {}]));
export const clone = value => JSON.parse(JSON.stringify(value));
export function same(a, b) {
  return groups.every(group => {
    const left = a[group] || {}, right = b[group] || {};
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => left[key] === right[key]);
  });
}
export function mergeStates(base, local, remote) {
  const merged = emptyState(), conflicts = [];
  for (const group of groups) {
    const keys = new Set([...Object.keys(base[group] || {}), ...Object.keys(local[group] || {}), ...Object.keys(remote[group] || {})]);
    for (const key of keys) {
      const before = base[group]?.[key], mine = local[group]?.[key], theirs = remote[group]?.[key];
      let value;
      if (mine === before) value = theirs;
      else if (theirs === before || mine === theirs) value = mine;
      else { value = mine; conflicts.push({ group, key, local: mine, remote: theirs }); }
      if (value !== undefined) merged[group][key] = value;
    }
  }
  return { merged, conflicts };
}
