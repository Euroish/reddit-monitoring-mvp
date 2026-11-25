declare module "franc-min" {
  interface FrancOptions {
    minLength?: number;
    whitelist?: string[];
    only?: string[];
    blacklist?: string[];
    ignore?: string[];
  }
  function franc(text: string, options?: FrancOptions): string;
  namespace franc {
    function all(text: string, options?: FrancOptions): Array<[string, number]>;
  }
  export = franc;
}

declare module "wink-porter2-stemmer" {
  function stemmer(word: string): string;
  export = stemmer;
}
