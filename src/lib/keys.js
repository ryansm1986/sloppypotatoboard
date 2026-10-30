// Converts browser key events to Electron accelerators and back to friendly labels.

const CODE_MAP = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
};

// Keys that are safe to grab system-wide without a modifier (you don't type with them).
const BARE_OK = /^(F\d{1,2}|num\w+|Insert|Home|End|PageUp|PageDown|Scrolllock|PrintScreen)$/;
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

export function accelFromEvent(e) {
  if (MODIFIER_KEYS.has(e.key)) return { pending: true };
  const c = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^Numpad\d$/.test(c)) key = `num${c.slice(6)}`;
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else key = CODE_MAP[c] || null;
  if (!key) return { error: "That key can't be a hotkey" };

  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !BARE_OK.test(key)) {
    return { error: 'Add Ctrl, Alt or Shift to that key so you can still type with it' };
  }
  return { accel: [...mods, key].join('+') };
}

const NUM_LABELS = { numadd: 'Num +', numsub: 'Num −', nummult: 'Num ×', numdiv: 'Num ÷', numdec: 'Num .' };

export function keyParts(accel) {
  if (!accel) return [];
  return accel.split('+').map((p) => {
    if (NUM_LABELS[p]) return NUM_LABELS[p];
    if (/^num\d$/.test(p)) return `Num ${p.slice(3)}`;
    if (p === 'Super') return 'Win';
    if (p === 'Scrolllock') return 'Scroll Lock';
    if (p === 'PageUp') return 'Page Up';
    if (p === 'PageDown') return 'Page Down';
    return p;
  });
}

export const keyLabel = (accel) => keyParts(accel).join(' + ');
