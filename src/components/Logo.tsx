import Image from 'next/image';

/** Selo circular da Se Tu For, Eu Vou! (o mesmo do portal e das LPs) + o nome do sistema. */
export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-1.5 py-1">
      <Image src="/stfv-selo.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0" priority />
      <div className="min-w-0 leading-tight">
        <b className="block font-display text-[19px] font-semibold tracking-[-0.01em]">SendFlow</b>
        <span className="block truncate text-[10.5px] font-medium uppercase tracking-[0.12em] text-blue">
          Se Tu For, Eu Vou!
        </span>
      </div>
    </div>
  );
}
