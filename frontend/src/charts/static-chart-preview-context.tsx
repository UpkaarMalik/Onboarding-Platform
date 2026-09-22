/* "use client" removed: a Next.js App Router directive with no
   meaning in this Vite SPA, and it stopped @vitejs/plugin-react
   injecting its Fast Refresh preamble into the module, which threw
   "can't detect preamble" at runtime. Only change made to the
   registry's source. */
import { createContext, type ReactNode, useContext } from "react";

const StaticChartPreviewContext = createContext(false);

/** Disables cartesian reveal clip-path for static docs previews. */
export function StaticChartPreviewProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <StaticChartPreviewContext.Provider value={true}>
      {children}
    </StaticChartPreviewContext.Provider>
  );
}

export function useStaticChartPreview() {
  return useContext(StaticChartPreviewContext);
}
