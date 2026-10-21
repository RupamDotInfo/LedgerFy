import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseCombobox from '@/components/ui/BaseCombobox.vue'

const options = [
  { id: 'a', label: 'Anand Textiles', sublabel: 'Customer' },
  { id: 'b', label: 'Bharat Tools', sublabel: 'Supplier' },
  { id: 'c', label: 'Kasturi Builders' },
]

describe('BaseCombobox', () => {
  it('filters options as the user types', async () => {
    const wrapper = mount(BaseCombobox, { props: { options } })
    const input = wrapper.get('input')

    await input.trigger('focus')
    expect(wrapper.findAll('[role="option"]').length).toBe(3)

    await input.setValue('bhar')
    const visible = wrapper.findAll('[role="option"]')
    expect(visible).toHaveLength(1)
    expect(visible[0]?.text()).toContain('Bharat Tools')
  })

  it('selects the highlighted option with the keyboard', async () => {
    const wrapper = mount(BaseCombobox, { props: { options } })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['b'])
  })

  it('emits a create request when the option list is empty and creation is allowed', async () => {
    const wrapper = mount(BaseCombobox, {
      props: { options, allowCreate: true },
    })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('Zeta Supplies')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('create')?.[0]).toEqual(['Zeta Supplies'])
  })

  it('shows an empty message when nothing matches', async () => {
    const wrapper = mount(BaseCombobox, { props: { options } })
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('nothing matches this')

    expect(wrapper.text()).toContain('No matches')
  })

  it('closes the list on Escape', async () => {
    const wrapper = mount(BaseCombobox, { props: { options } })
    const input = wrapper.get('input')

    await input.trigger('focus')
    expect(wrapper.findAll('[role="option"]').length).toBe(3)

    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.findAll('[role="option"]').length).toBe(0)
  })
})
