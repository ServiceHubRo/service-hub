import { createContext, useContext } from 'react';

/** 'owner', 'staff', or null while it is read (or without a shop). Filled by ShopRoleProvider. */
export const ShopRoleContext = createContext<'owner' | 'staff' | null>(null);

/** True for the owner; false for a colleague and while it is not known yet. */
export function useIsShopOwner(): boolean {
  return useContext(ShopRoleContext) === 'owner';
}

/** True only once the account is known to be a colleague. */
export function useIsColleague(): boolean {
  return useContext(ShopRoleContext) === 'staff';
}
