// BMUETTE design tokens: white cards on polished black. Content supplies the colour.
export const colors = {
  ink: '#0B0B0D', // app background
  inkRaised: '#17181B', // bars, sheets
  inkHigh: '#222327',
  line: 'rgba(255,255,255,0.08)',
  card: '#FFFFFF',
  cardSoft: '#F3F3F5', // fields and chips on a white card
  cardLine: 'rgba(17,18,20,0.08)',
  textOnInk: '#F5F5F7',
  textOnCard: '#111214',
  muted: '#8E9097', // secondary text on black
  mutedOnCard: '#6B6D74',
  danger: '#FF5A5F',
  success: '#34C77B',
  scrim: 'rgba(0,0,0,0.45)',
} as const;

export const radius = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
} as const;

// Type scale. Tight tracking on large sizes is what keeps it from looking like a template.
export const type = {
  display: { fontFamily: fonts.heavy, fontSize: 40, lineHeight: 42, letterSpacing: -1.4 },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 32, letterSpacing: -0.8 },
  heading: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 25, letterSpacing: -0.4 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  small: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, letterSpacing: 0 },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.3 },
} as const;

export const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  bar: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 16 },
} as const;

export const TAB_BAR = { height: 64, bottomGap: 12, sideGap: 16 } as const;
