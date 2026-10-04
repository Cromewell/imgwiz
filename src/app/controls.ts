import { clear, h } from './dom';
import type { Control, ToolHost } from './types';

/** Render a tool's declarative control list into the panel. */
export function renderControls<S>(host: HTMLElement, controls: Control<S>[], tool: ToolHost<S>): void {
  clear(host);
  for (const control of controls) {
    host.append(renderControl(control, tool));
  }
}

function renderControl<S>(control: Control<S>, tool: ToolHost<S>): HTMLElement {
  switch (control.kind) {
    case 'section':
      return h('div', { class: 'ctl-section' },
        h('h3', { text: control.label }),
        control.hint ? h('p', { class: 'ctl-hint', text: control.hint }) : null,
      );

    case 'slider':
      return renderSlider(control, tool);

    case 'toggle':
      return renderToggle(control, tool);

    case 'select':
      return renderSelect(control, tool);

    case 'segmented':
      return renderSegmented(control, tool);

    case 'presets':
      return renderPresets(control, tool);

    case 'actions':
      return h('div', { class: 'ctl-actions' },
        control.items.map((item) =>
          h('button', {
            class: 'btn btn-ghost',
            type: 'button',
            text: item.label,
            onclick: () => {
              item.run(tool.state);
              tool.update();
            },
          }),
        ),
      );

    case 'note':
      return h('p', { class: `ctl-note ${control.tone === 'warn' ? 'is-warn' : ''}`, text: control.text });

    case 'custom': {
      const wrap = h('div', { class: 'ctl-custom' });
      control.render(wrap, tool);
      return wrap;
    }
  }
}

function renderSlider<S>(control: Extract<Control<S>, { kind: 'slider' }>, tool: ToolHost<S>): HTMLElement {
  const value = control.get(tool.state);
  const display = control.format
    ? control.format(value)
    : `${Number.isInteger(control.step) ? Math.round(value) : value.toFixed(2)}${control.unit ?? ''}`;

  const readout = h('output', { class: 'ctl-value', text: display });
  const input = h('input', {
    class: 'ctl-range',
    type: 'range',
    min: control.min,
    max: control.max,
    step: control.step,
    value,
  }) as HTMLInputElement;

  const isNeutral = control.neutral !== undefined && Math.abs(value - control.neutral) < 1e-9;

  input.addEventListener('input', () => {
    const next = Number(input.value);
    control.set(tool.state, next);
    readout.textContent = control.format
      ? control.format(next)
      : `${Number.isInteger(control.step) ? Math.round(next) : next.toFixed(2)}${control.unit ?? ''}`;
    row.classList.toggle('is-modified', control.neutral === undefined ? next !== 0 : Math.abs(next - control.neutral) > 1e-9);
    tool.refresh();
  });

  const label = h('div', { class: 'ctl-label' },
    h('span', { text: control.label }),
    readout,
  );

  // Double-clicking the label snaps a slider back to its neutral value.
  if (control.neutral !== undefined) {
    label.classList.add('is-resettable');
    label.title = 'Double-click to reset';
    label.addEventListener('dblclick', () => {
      control.set(tool.state, control.neutral as number);
      tool.update();
    });
  }

  const row = h('div', { class: `ctl-row ${isNeutral ? '' : 'is-modified'}` }, label, input,
    control.hint ? h('p', { class: 'ctl-hint', text: control.hint }) : null,
  );
  return row;
}

function renderToggle<S>(control: Extract<Control<S>, { kind: 'toggle' }>, tool: ToolHost<S>): HTMLElement {
  const input = h('input', { type: 'checkbox', class: 'ctl-checkbox' }) as HTMLInputElement;
  input.checked = control.get(tool.state);
  input.addEventListener('change', () => {
    control.set(tool.state, input.checked);
    tool.update();
  });
  return h('label', { class: 'ctl-toggle' },
    input,
    h('span', {},
      h('span', { class: 'ctl-toggle-label', text: control.label }),
      control.hint ? h('span', { class: 'ctl-hint', text: control.hint }) : null,
    ),
  );
}

function renderSelect<S>(control: Extract<Control<S>, { kind: 'select' }>, tool: ToolHost<S>): HTMLElement {
  const select = h('select', { class: 'ctl-select' }) as HTMLSelectElement;
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const option of control.options) {
    const node = h('option', { value: option.value, text: option.label });
    if (option.group) {
      let group = groups.get(option.group);
      if (!group) {
        group = h('optgroup', { label: option.group }) as HTMLOptGroupElement;
        groups.set(option.group, group);
        select.append(group);
      }
      group.append(node);
    } else {
      select.append(node);
    }
  }
  select.value = control.get(tool.state);
  select.addEventListener('change', () => {
    control.set(tool.state, select.value);
    tool.update();
  });
  return h('div', { class: 'ctl-row' },
    h('div', { class: 'ctl-label' }, h('span', { text: control.label })),
    select,
    control.hint ? h('p', { class: 'ctl-hint', text: control.hint }) : null,
  );
}

function renderSegmented<S>(control: Extract<Control<S>, { kind: 'segmented' }>, tool: ToolHost<S>): HTMLElement {
  const current = control.get(tool.state);
  const group = h('div', { class: 'ctl-segmented', role: 'group' },
    control.options.map((option) =>
      h('button', {
        type: 'button',
        class: `seg ${option.value === current ? 'is-active' : ''}`,
        text: option.label,
        'aria-pressed': option.value === current,
        onclick: () => {
          control.set(tool.state, option.value);
          tool.update();
        },
      }),
    ),
  );
  return h('div', { class: 'ctl-row' },
    h('div', { class: 'ctl-label' }, h('span', { text: control.label })),
    group,
  );
}

function renderPresets<S>(control: Extract<Control<S>, { kind: 'presets' }>, tool: ToolHost<S>): HTMLElement {
  return h('div', { class: 'ctl-row' },
    h('div', { class: 'ctl-label' }, h('span', { text: control.label })),
    control.hint ? h('p', { class: 'ctl-hint', text: control.hint }) : null,
    h('div', { class: 'ctl-chips' },
      control.items.map((item) =>
        h('button', {
          type: 'button',
          class: `chip ${control.isActive(tool.state, item.id) ? 'is-active' : ''}`,
          title: item.hint ?? '',
          text: item.label,
          onclick: () => {
            control.apply(tool.state, item.id);
            tool.update();
          },
        }),
      ),
    ),
  );
}

/** Labelled number input, used by the resize and crop dimension blocks. */
export function numberField(
  label: string,
  value: number,
  onCommit: (value: number) => void,
  opts: { min?: number; max?: number; step?: number; suffix?: string } = {},
): HTMLElement {
  const input = h('input', {
    class: 'ctl-number',
    type: 'number',
    value: String(Math.round(value)),
    min: opts.min ?? 1,
    max: opts.max ?? 1e9,
    step: opts.step ?? 1,
    inputmode: 'numeric',
  }) as HTMLInputElement;

  const commit = () => {
    const next = Number(input.value);
    if (!Number.isFinite(next)) {
      input.value = String(Math.round(value));
      return;
    }
    onCommit(next);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') commit();
  });

  return h('label', { class: 'ctl-field' },
    h('span', { class: 'ctl-field-label', text: label }),
    h('span', { class: 'ctl-field-input' }, input, opts.suffix ? h('span', { class: 'ctl-suffix', text: opts.suffix }) : null),
  );
}
