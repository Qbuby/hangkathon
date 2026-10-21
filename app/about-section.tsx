import { BRAND } from "@/lib/brand";
import "./about.css";

export default function AboutSection() {
  return (
    <section id="about" className="about" aria-labelledby="about-title">
      <div className="about-head">
        <p className="eyebrow">ABOUT {BRAND.upper}</p>
        <h2 id="about-title">关于我们</h2>
        <p className="about-lead">
          杭客松连接 AI 创造者、真实需求与城市场景，让每个人都能用 AI 把想法做出来。如果 AI 真正成为每个人都可以自然调用的能力，杭州的生活会变成什么样？
        </p>
      </div>
    </section>
  );
}
