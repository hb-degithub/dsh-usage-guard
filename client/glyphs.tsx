/**
 * 面板自带的图标：不依赖宿主 ui-primitives 的图标导出。
 *
 * dsh 0.2.0 把图标集从 `IconXxx16` 改名为 `IconXxxOutlineRegular/Medium`，
 * 直接内联 artwork 可以同时兼容新旧宿主（图标只是一段 16×16 的 currentColor 路径）。
 */

/** 面板标题前的柱状图 glyph：currentColor，跟随主题。 */
export function UsageGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1.75" y="8.75" width="3.5" height="5.5" rx="0.9" fill="currentColor" />
      <rect x="6.25" y="4.75" width="3.5" height="9.5" rx="0.9" fill="currentColor" />
      <rect x="10.75" y="1.75" width="3.5" height="12.5" rx="0.9" fill="currentColor" />
    </svg>
  );
}

/** 超限提醒 glyph：与 dsh 0.2.0 的 IconWarningOutlineRegular 同一份 artwork（1px 描边）。 */
export function WarnGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" strokeWidth={1} style={{ flexShrink: 0 }}>
      <path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor" />
      <path d="M8 4.29199V9.79199" stroke="currentColor" />
      <path d="M8 10.708V11.708" stroke="currentColor" />
    </svg>
  );
}
