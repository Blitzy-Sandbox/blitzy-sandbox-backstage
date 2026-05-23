/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogAutocomplete } from './CatalogAutocomplete';

describe('CatalogAutocomplete', () => {
  const user = userEvent.setup();
  const mockOptions = ['Option 1', 'Option 2', 'Option 3'];

  it('renders without exploding', () => {
    render(
      <CatalogAutocomplete
        name="test-autocomplete"
        options={mockOptions}
        label="Test Label"
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders the expand icon', () => {
    render(
      <CatalogAutocomplete
        name="test-autocomplete"
        options={mockOptions}
        label="Test Label"
      />,
    );
    const expandIcon = screen.getByTestId('test-autocomplete-expand');
    expect(expandIcon).toBeInTheDocument();
  });

  it('displays options when clicked', async () => {
    render(
      <CatalogAutocomplete
        name="test-autocomplete"
        options={mockOptions}
        label="Test Label"
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);

    for (const option of mockOptions) {
      expect(await screen.findByText(option)).toBeInTheDocument();
    }
  });

  it('supports required input', async () => {
    render(
      <CatalogAutocomplete
        name="test-autocomplete"
        options={mockOptions}
        label="Test Label"
        TextFieldProps={{ required: true }}
      />,
    );

    // After the Radix-style refactor (see CatalogAutocomplete.tsx) the
    // closed trigger is a non-input `<div role="combobox">`; the real
    // `<input role="combobox" required />` is only rendered while the
    // picker is open. Open the picker first so the input element exists
    // in the DOM, then assert the `required` attribute is present.
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    await waitFor(() => {
      const comboboxes = screen.getAllByRole('combobox');
      const input = comboboxes.find(
        el => (el as HTMLElement).tagName.toLowerCase() === 'input',
      ) as HTMLInputElement | undefined;
      expect(input).toBeDefined();
      expect(input).toBeRequired();
    });
  });

  it('displays helper text when provided', () => {
    render(
      <CatalogAutocomplete
        name="test-autocomplete"
        options={mockOptions}
        label="Test Label"
        TextFieldProps={{ helperText: 'Helper text' }}
      />,
    );

    expect(screen.getByText('Helper text')).toBeInTheDocument();
  });

  it('renders without label', () => {
    render(
      <CatalogAutocomplete name="test-autocomplete" options={mockOptions} />,
    );

    const input = screen.getByRole('combobox');
    expect(input).toBeInTheDocument();
  });

  it('displays correct option on selection', async () => {
    // After the Radix-style refactor the picker closes on single-select
    // option click and the `<input role="combobox">` is unmounted. The
    // observable contract is now that `onChange` is fired with the
    // selected option value, which the parent uses to update its own
    // controlled state and re-render. Asserting via an `onChange` spy
    // is the most reliable equivalent to the legacy
    // `expect(input).toHaveValue('Option 1')` check.
    const handleChange = jest.fn();
    render(
      <CatalogAutocomplete
        name="test-autocomplete"
        options={mockOptions}
        label="Test Label"
        onChange={handleChange}
      />,
    );

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const optionToSelect = await screen.findByText('Option 1');
    await user.click(optionToSelect);

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(expect.anything(), 'Option 1');
    });
  });
});
