import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  Plus,
  RotateCcw,
  Search,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { saveData } from "../db/database";

const statuses = ["Waiting", "Being Seen", "Treated", "Released"];
export default function Queue({ data, setData }) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState(
    data.queue?.length
      ? data.queue
      : data.students.slice(0, 3).map((student, index) => ({
          student,
          status: statuses[index],
          joined: index === 0 ? "11:42 AM" : index === 1 ? "11:51 AM" : "12:04 PM",
          urgent: index === 0,
        })),
  );
  useEffect(() => {
    if (!data.queue?.length && queue.length > 0) {
      setData(saveData({ ...data, queue }));
    }
  }, []);
  const advance = (index) => {
    setQueue((items) => {
      const nextQueue = items.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, status: statuses[Math.min(statuses.indexOf(item.status) + 1, statuses.length - 1)] }
          : item,
      );
      setData(saveData({ ...data, queue: nextQueue }));
      return nextQueue;
    });
  };
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Clinic flow</p>
          <h2>
            Walk-in queue{" "}
            <span className="soft-count">{queue.length} active</span>
          </h2>
          <p>Keep every student moving through care with confidence.</p>
        </div>
        <button className="primary-btn" onClick={() => navigate('/new-visit')}>
          <Plus size={16} /> Add to queue
        </button>
      </div>
      <div className="queue-summary">
        {statuses.map((status) => (
          <div key={status}>
            <span>{status}</span>
            <strong>
              {queue.filter((item) => item.status === status).length}
            </strong>
          </div>
        ))}
      </div>
      <section className="panel queue-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Live queue</p>
            <h3>Students in clinic</h3>
          </div>
          <div className="search-box compact">
            <Search size={16} />
            <input placeholder="Search queue..." />
          </div>
        </div>
        {queue.map((item, index) => (
          <div className="queue-row" key={item.student.id}>
            <div
              className={`queue-status-dot status-${item.status.toLowerCase().replace(" ", "-")}`}
            />
            <div className="avatar small teal">
              {item.student.name
                .split(" ")
                .map((x) => x[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div className="queue-student">
              <strong>{item.student.name}</strong>
              <span>
                {item.student.gradeLevel} · {item.student.section} · Joined{" "}
                {item.joined}
              </span>
            </div>
            {item.urgent && <span className="urgent-badge">Urgent</span>}
            <span
              className={`status-chip ${item.status === "Waiting" ? "warn" : item.status === "Released" ? "neutral" : "success"}`}
            >
              {item.status}
            </span>
            <button
              className="secondary-btn queue-action"
              onClick={() => advance(index)}
            >
              {item.status === "Released" ? (
                <RotateCcw size={14} />
              ) : (
                <Check size={14} />
              )}{" "}
              {item.status === "Released" ? "Reopen" : "Advance"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
