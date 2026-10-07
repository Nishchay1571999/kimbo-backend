-- CreateEnum
CREATE TYPE "TargetMethod" AS ENUM ('suggested', 'custom');

-- CreateTable
CREATE TABLE "user_goal_targets" (
    "user_id" UUID NOT NULL,
    "calories_kcal" INTEGER NOT NULL,
    "protein_g" INTEGER NOT NULL,
    "method" "TargetMethod" NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_goal_targets_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_goal_targets_calories_range" CHECK ("calories_kcal" BETWEEN 1000 AND 5000),
    CONSTRAINT "user_goal_targets_protein_range" CHECK ("protein_g" BETWEEN 20 AND 300)
);

-- AddForeignKey
ALTER TABLE "user_goal_targets" ADD CONSTRAINT "user_goal_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
