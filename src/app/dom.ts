type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | number | null | undefined | false;

/** Minimal hyperscript helper — enough structure without pulling in a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Append children, skipping the null/false holes conditional markup leaves. */
export function append(node: HTMLElement, ...children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function icon(path: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

export const ICONS = {
  contrast: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  sun: 'M12 5V3m0 18v-2m7-7h2M3 12h2m11.9-4.9 1.4-1.4M5.7 18.3l1.4-1.4m0-9.8L5.7 5.7m12.6 12.6-1.4-1.4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  grid: 'M4 9h16M4 15h16M9 4v16M15 4v16',
  crop: 'M7 3v14h14M3 7h14v14',
  resize: 'M4 4h8v8H4zM12 12h8v8h-8M9 15H4v5h5v-5',
  swap: 'M4 8h13l-3-3m3 3-3 3M20 16H7l3-3m-3 3 3 3',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 19h14',
  image: 'M4 5h16v14H4zm0 10 4-4 5 5m2-3 2-2 3 3M15 9.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
};
