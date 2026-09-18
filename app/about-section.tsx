"use client";

import { Compass, Hammer, HeartHandshake } from "lucide-react";
import "./about.css";

const PRINCIPLES = [
  {
    icon: Compass,
    title: "身份不是入口，想法是入口",
    text: "它常常从一句模糊的话开始——“我妈总忘记关燃气”“这条街的老人总是错过公交”。这些话不需要先被写成需求，说话的人也不需要技术背景。在杭客松里，五岁的孩子和七十岁的老人在结构上完全平权。",
  },
  {
    icon: Hammer,
    title: "AI 不是产品，是人的新能力",
    text: "我们不希望 AI 只是被观看、被体验的东西。理想的状态是 AI 越强，人越自在：AI 很强，但人仍然可以喝茶。技术往前走，生活不必跟着变忙。",
  },
  {
    icon: HeartHandshake,
    title: "比赛负责点火，不负责判决",
    text: "排名、奖金和评审能让一个想法在短时间内变成大量真实尝试，这是它们的作用。但评审结束之后，真正的评价才刚开始——作品有没有被使用、被传播、被留下来。我们不为冠军而来，而是为足够多的真实尝试留下空间。",
  },
];

const FORCES = [
  { name: "全民", role: "现在被喜爱什么", detail: "大众体验、喜爱、共鸣与使用意愿。" },
  { name: "行家", role: "创新与完成度", detail: "行业经验与专业判断。" },
  { name: "场景方", role: "是否真的被用起来", detail: "作品回到真实生活之后的样子。" },
];

export default function AboutSection() {
  return (
    <section id="about" className="about" aria-labelledby="about-title">
      <div className="about-head">
        <p className="eyebrow">ABOUT HANGKESONG</p>
        <h2 id="about-title">关于我们</h2>
        <p className="about-lead">
          杭客松是杭州的创造发生装置。形式上它是一个开放的活动生态：企业、学校、社区、个人都可以持续发起活动，任何人都可以参与、提交、评价、展示。但它的内核换掉了通常的假设——没有身份档案，没有技术门槛，以想法和问题为单位，而不是以技能和专业为单位。
        </p>
      </div>

      <div className="about-principles">
        {PRINCIPLES.map((item) => (
          <article className="about-card" key={item.title}>
            <span className="about-card-icon"><item.icon size={22} /></span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>

      <div className="about-forces">
        <div className="about-forces-head">
          <h3>三种评价力量</h3>
          <p>一场活动的评价不该只有一个榜单。我们让三种不同的判断各自成立。</p>
        </div>
        <div className="about-forces-grid">
          {FORCES.map((force) => (
            <div className="about-force" key={force.name}>
              <strong>{force.name}</strong>
              <span>{force.role}</span>
              <p>{force.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <blockquote className="about-question">
        <p>如果 AI 真正成为每个人都可以自然调用的能力，杭州的生活会变成什么样？</p>
        <cite>这是杭客松始终围绕的问题</cite>
      </blockquote>

      <p className="about-note">
        当前网站是首页体验 Demo：活动内容均为演示数据，没有开放报名、提交或支付，也不代表已有合作方。
      </p>
    </section>
  );
}
