const INVISIBLE_FORMAT_RE = /\p{Cf}/u

const hasDisallowedControlCode = (content: string): boolean => {
  for (const character of content) {
    const codePoint = character.codePointAt(0)
    if (codePoint == null) {
      continue
    }

    const isAsciiControl =
      (codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f)
    const isExtendedControl = codePoint >= 0x7f && codePoint <= 0x9f

    if (isAsciiControl || isExtendedControl) {
      return true
    }
  }

  return false
}

const RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /(ignore|override|bypass).{0,80}(previous|prior|system|developer).{0,80}(instruction|prompt|message)/i,
    reason: 'Content looks like prompt-injection instructions.'
  },
  {
    pattern:
      /(reveal|dump|print|show|exfiltrat|leak|steal).{0,120}(system prompt|developer message|hidden prompt|api key|secret|token|password|credential)/i,
    reason: 'Content looks like an exfiltration or secret-harvesting instruction.'
  },
  {
    pattern:
      /(BEGIN OPENSSH PRIVATE KEY|BEGIN RSA PRIVATE KEY|ssh-(rsa|ed25519)\s+[A-Za-z0-9+/=]+|authorized_keys)/i,
    reason: 'Content looks like an SSH credential or backdoor payload.'
  }
]

export type MemorySecurityScanResult =
  | { ok: true }
  | {
      ok: false
      reason: string
    }

export function scanMemoryEntry(content: string): MemorySecurityScanResult {
  if (hasDisallowedControlCode(content) || INVISIBLE_FORMAT_RE.test(content)) {
    return {
      ok: false,
      reason: 'Content contains invisible or control Unicode characters that are not allowed.'
    }
  }

  for (const candidate of RISK_PATTERNS) {
    if (candidate.pattern.test(content)) {
      return {
        ok: false,
        reason: candidate.reason
      }
    }
  }

  return { ok: true }
}
