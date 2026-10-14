const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

type Props = {
  value: number | null;
  /** Минимум разрядов: счётчик ленты всегда показывает ведущие нули. */
  digits?: number;
  tone?: "amber" | "dim" | "brick" | "off";
  small?: boolean;
  label?: string;
};

/** Счётчик ленты: каждая цифра прокатывается барабаном к новому значению. */
export function Counter({ value, digits = 4, tone = "amber", small, label }: Props) {
  const text = value === null ? "-".repeat(digits) : String(value).padStart(digits, "0");
  return (
    <span
      className={`counter${small ? " counter-small" : ""}`}
      data-tone={value === null ? "off" : tone}
      role="img"
      aria-label={label ?? (value === null ? "нет данных" : String(value))}
    >
      {[...text].map((char, index) => (
        // Разряды стабильны по позиции: ключ по индексу здесь и нужен, чтобы барабан крутился, а не пересоздавался.
        // biome-ignore lint/suspicious/noArrayIndexKey: позиция разряда и есть его идентичность
        <span className="digit" key={index} aria-hidden="true">
          {char === "-" ? (
            "-"
          ) : (
            <span className="digit-strip" style={{ transform: `translateY(-${Number(char)}em)` }}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
