// Typen fuer die Instanz-Konfiguration (Gegenstueck zu native in io-package.json)
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      email: string;
      password: string;
      deviceSn: string;
      throttleSeconds: number;
    }
  }
}

export {};
