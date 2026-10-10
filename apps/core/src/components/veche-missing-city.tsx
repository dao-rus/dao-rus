import Link from "next/link";
import type {InterfaceTextValues} from "../lib/interface-texts";

export function VecheMissingCity({texts}:{texts:InterfaceTextValues}) {
  return <p>{texts["veche.missing_city"]} <Link href="/profile#residence-name">{texts["veche.specify_city"]}</Link></p>;
}
