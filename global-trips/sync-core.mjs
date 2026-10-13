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

// Keep legacy keys intact; each traveller gets independent sync fields.
const personalKeys = new Set(['dive-socks','shoes','hat','waterproof-pouch','grab','shoes2','prep-toiletries','prep-towel','prep-mask','charge','liquid']);
export function preparationRows(item) {
  const each = item.preparationMode === 'each' || (!item.preparationMode && personalKeys.has(item.key));
  return each ? ['JT','QX'].map(owner => ({...item, key:`${item.key}:${owner}`, owner, sourceKey:item.key, each:true})) : [{...item, sourceKey:item.key, shared:item.owner === 'JT+QX'}];
}
export const packingEntries = trip => trip.packing.flatMap(group => group.items.flatMap(preparationRows));
export function preparationFields(trip) {
  const rows = packingEntries(trip);
  return {
    checks: rows.flatMap(item => [item.key, `review:${item.key}`]),
    packingStates: rows.filter(item => item.kind !== 'task').map(item => item.key),
    notes: rows.flatMap(item => [`prep:${item.key}`, ...(item.shared ? [`owner:${item.key}`] : [])])
  };
}
