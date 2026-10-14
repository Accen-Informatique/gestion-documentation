// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // Application sans SSR : générée en fichiers statiques (npm run generate) et servie par l'Express
  ssr: false,
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Documentation · Accen',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#f6f7fb' },
        { name: 'robots', content: 'noindex' }
      ],
      // Applique le thème mémorisé avant le premier affichage (clair par défaut)
      script: [{
        innerHTML: "try{if(localStorage.getItem('doc-theme')==='dark'){document.documentElement.dataset.theme='dark';document.querySelector('meta[name=theme-color]')?.setAttribute('content','#0e1116')}}catch(e){}",
        tagPosition: 'head'
      }],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' }
      ]
    }
  },

  // Variables publiques (surchargées par NUXT_PUBLIC_*)
  runtimeConfig: {
    public: {
      apiBase: 'https://documentation.accen.me/api/v1', // NUXT_PUBLIC_API_BASE : routes de l'Express (core/datas/data.js)
      cryptageKey: '' // NUXT_PUBLIC_CRYPTAGE_KEY : même valeur que config.cryptageKey de l'Express
    }
  },

  // crypto-js préparé dès le démarrage : évite que Vite re-optimise en cours de route (double copie de Vue)
  vite: {
    optimizeDeps: {
      include: ['crypto-js/aes', 'crypto-js/enc-utf8', 'marked', 'dompurify']
    }
  }
})
