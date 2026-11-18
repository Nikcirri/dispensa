<script lang="ts" module>
  // Icone a tratto disegnate per l'app (24 × 24).
  const PATHS = {
    close: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    chevronLeft: 'M15 18l-6-6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    chevronDown: 'M6 9l6 6 6-6',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4',
    barcode: 'M3 6V4h3M18 4h3v2M21 18v2h-3M6 20H3v-2M7 8v8M10 8v8M13 8v8M15.5 8v8M17.5 8v8',
    edit: 'M4 20h4L18.5 9.5l-4-4L4 16v4zM13 7l4 4',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
    camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z',
    image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l5-5 4 4 2-2 5 5M15.5 8.5v.01',
    sparkles: 'M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z',
    key: 'M8 11a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM10.8 12.2L19 4M16 7l2.5 2.5M14 9l2 2',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5',
    share: 'M18 3.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM6 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM8.2 13.3l7.6 3.9M15.8 6.8l-7.6 3.9',
    heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z',
    cart: 'M3 4h2.5l2.2 11h10.6l2-8H7M9.5 19.5a1 1 0 1 0 0 .01M17 19.5a1 1 0 1 0 0 .01',
    cartPlus: 'M3 4h2.5l2.2 11h10.6l2-8H7M9.5 19.5a1 1 0 1 0 0 .01M17 19.5a1 1 0 1 0 0 .01M13 8.5v4M11 10.5h4',
    // Ingranaggio simmetrico a 8 denti (calcolato: il vecchio era storto).
    gear: 'M9.32 4.89L9.97 2L14.03 2L14.68 4.89L15.14 5.08L17.64 3.5L20.5 6.36L18.92 8.86L19.11 9.32L22 9.97L22 14.03L19.11 14.68L18.92 15.14L20.5 17.64L17.64 20.5L15.14 18.92L14.68 19.11L14.03 22L9.97 22L9.32 19.11L8.86 18.92L6.36 20.5L3.5 17.64L5.08 15.14L4.89 14.68L2 14.03L2 9.97L4.89 9.32L5.08 8.86L3.5 6.36L6.36 3.5L8.86 5.08Z M12 8.6a3.4 3.4 0 1 0 0 6.8a3.4 3.4 0 1 0 0-6.8z',
    flash: 'M13 2L4.5 13.5H11L10 22l8.5-11.5H12z',
    jar: 'M8 3h8v3H8zM7 6h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2zM9 12h6M9 15.5h4',
    fridge: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 10h14M8.5 6v2M8.5 13v3',
    snowflake: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5',
    chef: 'M7 14v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5M7 14a4 4 0 0 1-1.2-7.8A4.5 4.5 0 0 1 12 4a4.5 4.5 0 0 1 6.2 2.2A4 4 0 0 1 17 14zM7 17h10',
    clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7.5V12l3 2',
    home: 'M3.5 11L12 4l8.5 7M6 9.5V19a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9.5',
    copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM6.5 6.5h1v1h-1zM16.5 6.5h1v1h-1zM6.5 16.5h1v1h-1z',
    users: 'M9 4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM2.5 20c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2.2.6 3.5 2.4 3.5 5.2',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6v.01M4.5 12v.01M4.5 18v.01',
    chart: 'M4 20V13M10 20V9M16 20V5M22 20H2',
    leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7',
    box: 'M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5L12 12l8.5-4.5M12 12v9',
    more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
    pencilLine: 'M4 20h16M6 16l9.5-9.5 3 3L9 19H6z',
    keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 10v.01M10 10v.01M14 10v.01M18 10v.01M7 14h10',
    receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3',
    tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5v.01',
  } as const;

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 24, filled = false, stroke = 2 }: { name: IconName; size?: number; filled?: boolean; stroke?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={name === 'more' ? 3 : stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
