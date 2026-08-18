/**
 * TacklePhase を state.ts から切り出した独立ファイル。sim/kickoff.ts が
 * PlayerState の型 (state.ts) と TacklePhase の値の両方を必要とするが、
 * state.ts 側も selectPassTarget 等の配置ロジックを kickoff.ts に委譲するため、
 * 単純に両方が `./state` を参照し合うと循環importになる。TacklePhase をここに
 * 独立させることで、kickoff.ts は state.ts を型としてのみ参照すればよくなり
 * (type-only importは実行時の循環を生まない)、循環を完全に断ち切れる。
 * state.ts はこれを再exportし、既存の `from './state'` という参照はそのまま使える。
 */
export enum TacklePhase {
  None = 'None',
  Windup = 'Windup',
  Active = 'Active',
  Recovery = 'Recovery',
  /**
   * ★24周目-6 (台帳L-06)★ ショルダーチャージ後の隙。移動上の扱いは Recovery と同じだが、
   * 描画がスライディング(横倒れ)とチャージ(体を寄せる)を見分けるために独立させた。
   * 旧実装はチャージ後も Recovery を使い回しており、画面上はスライディングの
   * 倒れ込み(34°)が一瞬出るだけ = 「チャージの見た目が無い」報告の一因。
   */
  ChargeRecovery = 'ChargeRecovery',
}
