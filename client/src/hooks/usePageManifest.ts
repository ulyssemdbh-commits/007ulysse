import { useEffect } from "react";

interface ManifestOptions {
  title: string;
  manifestPath: string;
  themeColor: string;
  appleTitle: string;
}

export function usePageManifest(options: ManifestOptions) {
  useEffect(() => {
    const { title, manifestPath, themeColor, appleTitle } = options;
    
    // Update document title
    const originalTitle = document.title;
    document.title = title;
    
    // Find or create manifest link
    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
    const originalManifest = manifestLink?.href;
    
    if (manifestLink) {
      manifestLink.href = manifestPath;
    } else {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      manifestLink.href = manifestPath;
      document.head.appendChild(manifestLink);
    }

    // Update apple-mobile-web-app-title
    let appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement;
    const originalAppleTitle = appleTitleMeta?.content;
    if (!appleTitleMeta) {
      appleTitleMeta = document.createElement("meta");
      appleTitleMeta.name = "apple-mobile-web-app-title";
      document.head.appendChild(appleTitleMeta);
    }
    appleTitleMeta.content = appleTitle;

    // Update theme-color
    let themeColorMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
    const originalThemeColor = themeColorMeta?.content;
    if (themeColorMeta) {
      themeColorMeta.content = themeColor;
    }

    return () => {
      // Restore original values on unmount
      document.title = originalTitle;
      if (manifestLink && originalManifest) {
        manifestLink.href = originalManifest;
      }
      if (themeColorMeta && originalThemeColor) {
        themeColorMeta.content = originalThemeColor;
      }
      if (appleTitleMeta && originalAppleTitle) {
        appleTitleMeta.content = originalAppleTitle;
      }
    };
  }, [options.title, options.manifestPath, options.themeColor, options.appleTitle]);
}
