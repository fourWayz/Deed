import { TEAM_WALLETS } from "./config";
import { anyOutside } from "./outsider";

/** True once a wallet that is not one of the team's test wallets shows up. */
export const hasOutsider = (addresses: string[]): boolean => anyOutside(addresses, TEAM_WALLETS);
