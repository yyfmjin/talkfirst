export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isPasswordStrongEnough(value: string): boolean {
  return value.length >= 8;
}
