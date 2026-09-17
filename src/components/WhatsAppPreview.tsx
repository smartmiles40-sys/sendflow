import Image from 'next/image';
import type { CampaignType } from '@/lib/types';

// Faithful recreation of the approved mockup's WhatsApp look: a dark chat pane
// with a group header, a single outgoing bubble (#005c4b) pinned right, and the
// subtle dotted wallpaper. Pure/presentational so it can update live as the
// composer state changes on the client.

// Same tiny dotted wallpaper the mockup ships, as a repeating data-URI.
const WALLPAPER =
  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"40\"><circle cx=\"4\" cy=\"4\" r=\"1\" fill=\"%23131f27\"/></svg>')";

const mediaPlaceholder: Record<Exclude<CampaignType, 'texto' | 'imagem'>, { icon: string; label: string }> = {
  video: { icon: '🎬', label: 'Vídeo' },
  pdf: { icon: '📄', label: 'Documento PDF' },
};

export function WhatsAppPreview({
  tipo,
  mensagem,
  midiaUrl,
  mencionarTodos,
}: {
  tipo: CampaignType;
  mensagem: string;
  midiaUrl: string | null;
  mencionarTodos: boolean;
}) {
  const hasMedia = tipo !== 'texto';

  return (
    <div>
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        Prévia no WhatsApp
      </div>

      <div className="overflow-hidden rounded-[22px] border border-border bg-[#0b141a] shadow-[0_24px_60px_rgba(0,0,0,.5)]">
        {/* Group header */}
        <div className="flex items-center gap-2.5 bg-[#1f2c34] px-3.5 py-3">
          <Image src="/stfv-selo.png" alt="" width={34} height={34} className="h-[34px] w-[34px] shrink-0 rounded-full" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#e9edef]">Expedição Japão — Turma Outubro</div>
            <div className="text-[11px] text-[#8696a0]">você, +47 participantes</div>
          </div>
        </div>

        {/* Chat body */}
        <div
          className="min-h-[340px] px-3 py-4"
          style={{ backgroundColor: '#0b141a', backgroundImage: WALLPAPER }}
        >
          <div className="ml-auto max-w-[86%] rounded-[10px] rounded-tr-[2px] bg-[#005c4b] px-2 pb-2 pt-1.5 text-[13.5px] leading-[1.42] text-[#e9edef] shadow-[0_1px_1px_rgba(0,0,0,.2)]">
            {hasMedia && (
              <div className="relative mb-1.5 overflow-hidden rounded-[7px]">
                {tipo === 'imagem' && midiaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={midiaUrl} alt="" className="block w-full" />
                ) : tipo === 'imagem' ? (
                  <div className="flex flex-col items-center justify-center gap-1 bg-black/40 py-9 text-[#a7c4bc]">
                    <span className="text-2xl">🖼️</span>
                    <span className="text-[11px]">Sua imagem aparece aqui</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1 bg-black/40 py-9 text-[#a7c4bc]">
                    <span className="text-2xl">{mediaPlaceholder[tipo].icon}</span>
                    <span className="text-[11px]">
                      {midiaUrl ? mediaPlaceholder[tipo].label : `${mediaPlaceholder[tipo].label} · anexado`}
                    </span>
                  </div>
                )}
              </div>
            )}

            {mencionarTodos && <span className="text-[#53bdeb]">@todos </span>}
            {mensagem ? (
              <span className="whitespace-pre-wrap break-words">{mensagem}</span>
            ) : (
              <span className="text-[#8fb9ae]">sua mensagem…</span>
            )}

            <div className="mt-1 text-right text-[10px] text-[#8fb9ae]">agora ✓✓</div>
          </div>
        </div>
      </div>

      <div className="mt-2.5 text-center text-[11.5px] text-muted">
        Atualiza conforme você digita · igual chega no grupo
      </div>
    </div>
  );
}
