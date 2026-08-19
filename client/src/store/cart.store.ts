import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartItem {
  id:             string
  slug:           string
  title:          string
  thumbnailUrl?:  string
  price?:         number
  /* Backend-resolved checkout amounts (see lib/coursePrice.ts). Items added
     before these fields existed simply fall back to the USD display. */
  priceAED?:      number
  priceINR?:      number
  isFree?:        boolean
  instructorName?: string
}

interface CartStore {
  items:      CartItem[]
  addItem:    (item: CartItem) => void
  removeItem: (id: string) => void
  clearCart:  () => void
  isInCart:   (id: string) => boolean
}

/* The cart is for PAID courses only — free courses enroll directly. */
const isFreeItem = (item: CartItem) => item.isFree || !item.price || item.price === 0

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem:    item => {
        if (isFreeItem(item) || get().isInCart(item.id)) return
        set(s => ({ items: [...s.items, item] }))
      },
      removeItem: id   => set(s => ({ items: s.items.filter(i => i.id !== id) })),
      clearCart:  ()   => set({ items: [] }),
      isInCart:   id   => get().items.some(i => i.id === id),
    }),
    {
      name: 'lms-cart',
      /* Drop any free items left over from older builds that mis-added them. */
      onRehydrateStorage: () => state => {
        if (state) state.items = state.items.filter(i => !isFreeItem(i))
      },
    },
  ),
)
