import { Briefcase, GraduationCap, Mic, PartyPopper, Sparkles, Trophy, Wrench } from 'lucide-react';

/**
 * Event categories (keys match the API). Each has a `label` for filters (plural), `one` for a single
 * event, an icon and two colours used by the cover
 * art: `deep` (background, white text on it passes WCAG AA) and `light` (pattern highlights).
 */
export const CATEGORIES = [
  { key: 'career', label: 'Careers', one: 'Careers', icon: Briefcase, deep: '#1d3fb8', light: '#8fb0ff' },
  { key: 'talk', label: 'Talks', one: 'Talk', icon: Mic, deep: '#6b2fb3', light: '#c9a6ff' },
  { key: 'workshop', label: 'Workshops', one: 'Workshop', icon: Wrench, deep: '#9a4a0c', light: '#ffbe85' },
  { key: 'academic', label: 'Academic', one: 'Academic', icon: GraduationCap, deep: '#0f6e63', light: '#7fe0cf' },
  { key: 'social', label: 'Social', one: 'Social', icon: PartyPopper, deep: '#b0245b', light: '#ff9fc4' },
  { key: 'sports', label: 'Sports', one: 'Sports', icon: Trophy, deep: '#3a6b12', light: '#b6e57c' },
  { key: 'other', label: 'Other', one: 'Other', icon: Sparkles, deep: '#334155', light: '#a5b4cc' },
];
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const categoryOf = (key) => BY_KEY[key] || BY_KEY.other;
