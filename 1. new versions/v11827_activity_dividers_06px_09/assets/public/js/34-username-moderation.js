/* =============================================================================
   34-username-moderation.js
   Central username content moderation for public @handles.

   Scope: usernames only. Display names intentionally use separate rules.
   ============================================================================= */
(function() {
  'use strict';

  const RESTRICTED_USERNAME_MESSAGE = 'This username is not allowed. Please choose another one.';

  const LEET_MAP = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '@': 'a',
    '$': 's',
    '!': 'i',
    '+': 't'
  };

  const SEVERE_CONTAINS = [
    'chink',
    'fag',
    'faggot',
    'gook',
    'kike',
    'nazi',
    'nigger',
    'nigga',
    'raghead',
    'retard',
    'spic',
    'spik',
    'tranny'
  ];

  const SEVERE_FALSE_POSITIVE_SAFE_WORDS = [
    'spice',
    'spicy',
    'auspicious'
  ];

  const PROFANITY_EXACT_OR_TOKEN = [
    'bitch',
    'bastard',
    'cunt',
    'dick',
    'fuck',
    'fucker',
    'fucking',
    'motherfucker',
    'pussy',
    'shit',
    'shitty',
    'asshole'
  ];

  const PROFANITY_CONTAINS = [
    'asshole',
    'bullshit',
    'dickhead',
    'fuckyou',
    'motherfuck',
    'shithead'
  ];

  const EXPLICIT_CONTAINS = [
    'bestiality',
    'blowjob',
    'cumshot',
    'deepthroat',
    'gangbang',
    'hardcore',
    'incest',
    'nude',
    'onlyfans',
    'pedophile',
    'pedo',
    'porn',
    'xxx'
  ];

  const EXPLICIT_EXACT_OR_TOKEN = [
    'rape',
    'rapist',
    'sex'
  ];

  const RESERVED_EXACT = [
    'admin',
    'administrator',
    'creator',
    'developer',
    'devteam',
    'founder',
    'mod',
    'moderator',
    'official',
    'owner',
    'premium',
    'pro',
    'root',
    'shelfd',
    'shelfdadmin',
    'shelfdapp',
    'shelfdofficial',
    'shelfdstaff',
    'shelfdsupport',
    'shelfdteam',
    'staff',
    'support',
    'system',
    'verified'
  ];

  const RESERVED_ROOTS = [
    'admin',
    'administrator',
    'creator',
    'developer',
    'devteam',
    'founder',
    'mod',
    'moderator',
    'official',
    'owner',
    'root',
    'shelfd',
    'staff',
    'support',
    'system',
    'verified'
  ];

  function stripDiacritics(value) {
    try {
      return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {
      return String(value || '');
    }
  }

  function normalizeUsernameForModeration(username) {
    return stripDiacritics(username)
      .toLowerCase()
      .trim()
      .replace(/[013457@$!+]/g, (ch) => LEET_MAP[ch] || ch)
      .replace(/[\s._-]+/g, '')
      .replace(/(.)\1{2,}/g, '$1$1');
  }

  function getModerationTokens(username) {
    const raw = stripDiacritics(username).toLowerCase().trim();
    return raw
      .replace(/[013457@$!+]/g, (ch) => LEET_MAP[ch] || ch)
      .split(/[\s._-]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function containsSevereTerm(normalized) {
    if (!normalized) return false;
    let severeText = normalized;
    for (const safe of SEVERE_FALSE_POSITIVE_SAFE_WORDS) {
      severeText = severeText.split(safe).join('');
    }
    return SEVERE_CONTAINS.some((term) => severeText.includes(term));
  }

  function containsProfanity(normalized, tokens) {
    if (!normalized) return false;
    if (PROFANITY_CONTAINS.some((term) => normalized.includes(term))) return true;
    return PROFANITY_EXACT_OR_TOKEN.some((term) => normalized === term || tokens.includes(term));
  }

  function containsExplicitTerm(normalized, tokens) {
    if (!normalized) return false;
    if (EXPLICIT_CONTAINS.some((term) => normalized.includes(term))) return true;
    return EXPLICIT_EXACT_OR_TOKEN.some((term) => normalized === term || tokens.includes(term));
  }

  function isReservedUsername(normalized) {
    if (!normalized) return false;
    if (RESERVED_EXACT.includes(normalized)) return true;
    if (normalized.includes('shelfd')) {
      return RESERVED_ROOTS.some((root) => root !== 'shelfd' && normalized.includes(root));
    }
    if (normalized.startsWith('shelfd') || normalized.endsWith('shelfd')) return true;
    return false;
  }

  function validateUsernameContent(username) {
    const normalized = normalizeUsernameForModeration(username);
    const tokens = getModerationTokens(username);
    if (!normalized) return { allowed: true };
    if (containsSevereTerm(normalized)) return { allowed: false, reason: 'restricted_language' };
    if (containsProfanity(normalized, tokens)) return { allowed: false, reason: 'restricted_language' };
    if (containsExplicitTerm(normalized, tokens)) return { allowed: false, reason: 'restricted_language' };
    if (isReservedUsername(normalized)) return { allowed: false, reason: 'reserved_username' };
    return { allowed: true };
  }

  function isUsernameRestricted(username) {
    return !validateUsernameContent(username).allowed;
  }

  window.ShelfdUsernameModeration = Object.freeze({
    message: RESTRICTED_USERNAME_MESSAGE,
    normalizeUsernameForModeration,
    validateUsernameContent,
    isUsernameRestricted
  });
})();
