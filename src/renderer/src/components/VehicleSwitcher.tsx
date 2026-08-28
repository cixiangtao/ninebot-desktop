import { Bike, Check, ChevronDown } from "lucide-react";
import type { VehicleSummary } from "../../../shared/contracts";

interface VehicleSwitcherProps {
  vehicles: VehicleSummary[];
  selectedVehicle: VehicleSummary;
  live: boolean;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSelect: (vehicle: VehicleSummary) => void;
}

/** Selects a renderer-safe vehicle ID without exposing upstream serial numbers. */
export const VehicleSwitcher = ({
  vehicles,
  selectedVehicle,
  live,
  open,
  disabled,
  onToggle,
  onSelect,
}: VehicleSwitcherProps) => (
  <div className="vehicle-switcher">
    <button
      className="vehicle-card"
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="vehicle-picker"
      disabled={disabled}
    >
      <span className="vehicle-card-icon">
        <Bike size={22} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <strong className="block truncate text-[17px] font-[680] text-[#172332]">
          {selectedVehicle.name}
        </strong>
        <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <i className={`size-2 rounded-full ${live ? "bg-[#13b9a8]" : "bg-amber-400"}`} />
          {live ? "已连接" : "演示数据"}
          {` · ${selectedVehicle.access === "shared" ? "共享车辆" : "自有车辆"}`}
          {vehicles.length > 1 ? ` · ${vehicles.length} 辆` : ""}
        </span>
      </span>
      <ChevronDown size={17} className={open ? "rotate-180 text-[#087f76]" : "text-slate-400"} />
    </button>

    {open ? (
      <div className="vehicle-picker" id="vehicle-picker" role="listbox" aria-label="选择车辆">
        {vehicles.map((vehicle) => {
          const selected = vehicle.id === selectedVehicle.id;
          return (
            <button
              key={vehicle.id}
              className={`vehicle-option ${selected ? "vehicle-option-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(vehicle)}
            >
              <span className="vehicle-option-icon">
                <Bike size={18} />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <strong>{vehicle.name}</strong>
                <small>
                  {vehicle.model} · {vehicle.access === "shared" ? "共享车辆" : "自有车辆"}
                </small>
              </span>
              {selected ? <Check size={16} /> : null}
            </button>
          );
        })}
      </div>
    ) : null}
  </div>
);
