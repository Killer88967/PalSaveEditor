// import { WikiIcon } from "../wiki-browser";

export function LostPal() {
  return (
    <div className="relative flex items-end justify-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-2 left-1/2 h-5 w-64 -translate-x-1/2 rounded-[100%] bg-black/40 blur-xl"
      />
      <span
        className="select-none text-[8rem] font-black leading-none tracking-tighter sm:text-[12rem]"
        style={{ color: "var(--color-subtle)" }}
      >
        404
      </span>

      {/* <WikiIcon
        icon="negativekoala"
        alt="Depresso, sulking"
        className="pointer-events-none fixed bottom-0 right-2 z-0 hidden size-40 translate-y-4 opacity-90 drop-shadow-xl sm:block lg:size-52"
      /> */}
    </div>
  );
}
