import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.safirworld.novaplanner',
  appName: 'NOVA Planner',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#090d1b' },
  plugins: { LocalNotifications: { iconColor: '#61e6ef' } }
};

export default config;
