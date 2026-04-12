export const PASSWORD_REQUIREMENTS_MESSAGE =
  'La contraseña debe tener al menos 8 caracteres e incluir al menos una letra y un número.';

export const SPANISH_PHONE_MESSAGE =
  'Introduce un teléfono español válido.';

export interface PhoneValidationResult {
  isValid: boolean;
  normalized: string;
  error?: string;
}

export function validatePassword(password: string) {
  const hasMinLength = password.length >= 8;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const isValid = hasMinLength && hasLetter && hasNumber;

  return {
    isValid,
    error: isValid ? undefined : PASSWORD_REQUIREMENTS_MESSAGE,
  };
}

export function validateSpanishPhone(phone: string): PhoneValidationResult {
  const cleaned = phone.trim().replace(/[\s().-]/g, '');

  if (!cleaned) {
    return {
      isValid: false,
      normalized: '',
      error: 'El teléfono es obligatorio.',
    };
  }

  let normalizedInput = cleaned;

  if (normalizedInput.startsWith('0034')) {
    normalizedInput = `+34${normalizedInput.slice(4)}`;
  } else if (normalizedInput.startsWith('34') && normalizedInput.length === 11) {
    normalizedInput = `+${normalizedInput}`;
  }

  const nationalNumber = normalizedInput.startsWith('+34')
    ? normalizedInput.slice(3)
    : normalizedInput;

  if (!/^[6789]\d{8}$/.test(nationalNumber)) {
    return {
      isValid: false,
      normalized: '',
      error: SPANISH_PHONE_MESSAGE,
    };
  }

  return {
    isValid: true,
    normalized: `+34${nationalNumber}`,
  };
}
