import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nikcirri.dispensa',
  appName: 'Dispensa',
  webDir: 'dist',
  backgroundColor: '#F1F3EE',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_dispensa',
      iconColor: '#3F8A1F',
    },
  },
};

export default config;
