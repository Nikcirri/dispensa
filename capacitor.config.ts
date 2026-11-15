import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nikcirri.dispensa',
  appName: 'Dispensa',
  webDir: 'dist',
  backgroundColor: '#F8F9FA',
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
      iconColor: '#4E8752',
    },
  },
};

export default config;
